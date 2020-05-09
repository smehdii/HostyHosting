import React from 'react';
import CreateApplication from './CreateApplication';
import { useApplicationsQuery } from '../../queries';
import SelectOrganization from './SelectOrganization';
import PageHeader from '../ui/PageHeader';
import Dropdown, { DropdownItem } from '../ui/Dropdown';
import List, { ListItem } from '../ui/List';
import Card from '../ui/Card';
import { useParams } from 'react-router-dom';
import CreateEnvironment from './CreateEnvironment';
import useBoolean from '../../utils/useBoolean';

// TODO: Don't make the default route go here, instead use a redirect to route into
// the personal organization `/orgs/:username`.
export default function Home() {
    // TODO: Don't do this:
    // NOTE: If not present, we will assume the user personal organization
    const { organization } = useParams();

    const { data, loading } = useApplicationsQuery({
        variables: {
            org: organization,
        },
    });

    const [applicationVisible, { off: applicationOff, on: applicationOn }] = useBoolean(false);
    const [environmentVisible, { off: environmentOff, on: environmentOn }] = useBoolean(false);

    return (
        <div>
            <PageHeader>
                <div className="flex">
                    <div className="flex-grow">
                        <SelectOrganization organization={organization} />
                    </div>
                    <Dropdown label="New" variant="primary">
                        <DropdownItem onClick={applicationOn}>New Application</DropdownItem>
                        <DropdownItem onClick={environmentOn}>New Environment</DropdownItem>
                        <DropdownItem>New Router</DropdownItem>
                    </Dropdown>
                </div>
            </PageHeader>

            <main>
                <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                    <div className="px-4 py-4 sm:px-0 space-y-6">
                        <Card
                            header={
                                <h3 className="text-lg leading-6 font-medium text-gray-900">
                                    Applications
                                </h3>
                            }
                        >
                            <ul>
                                {data?.organization.applications.map(application => (
                                    <ListItem
                                        key={application.id}
                                        to={`/orgs/${data.organization.username}/apps/${application.name}`}
                                    >
                                        <div className="text-sm leading-5 font-medium text-indigo-600 truncate">
                                            {application.name}
                                        </div>
                                    </ListItem>
                                ))}
                            </ul>
                        </Card>

                        <Card title="Environments">
                            <List items={data?.organization.environments}>
                                {environment => (
                                    <ListItem key={environment.id}>
                                        <div className="text-sm leading-5 font-medium text-indigo-600 truncate">
                                            {environment.label}
                                        </div>
                                    </ListItem>
                                )}
                            </List>
                        </Card>
                        <CreateEnvironment
                            organization={data?.organization.id}
                            open={environmentVisible}
                            onClose={environmentOff}
                        />
                    </div>
                </div>
            </main>

            <CreateApplication
                organization={data?.organization.id}
                visible={applicationVisible}
                onClose={applicationOff}
            />
        </div>
    );
}
